import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { normalizePublicKey } from "../../../typescript/src/Base58Codec.js";
import { buildChanceryInstruction } from "../../../typescript/src/ChanceryInstruction.js";
import { CHANCERY_SCHEMA, getChanceryConstant, ZERO_ADDRESS } from "../../../typescript/src/ChancerySchema.js";
import { derivePendingConfigChangeAddress, derivePermissionRecordAddress, deriveUsageWindowAddress, dimensionScopeHash,
    knownPdaAddress, requireBigIntField, requireBigIntArrayField, requireNumberField, requirePublicKeyField, SCOPE, WINDOW_KIND } from "../../../typescript/src/client/ChanceryProtocol.js";
import { controllerAuthority } from "../controller/Authority.js";
import { readChanceryAccount } from "../execution/Account.js";
import type { DevnetContext } from "../execution/Context.js";
import { submitInstructions } from "../execution/Transaction.js";
import { executeChanceryInstruction } from "../instructions/ExecuteChancery.js";
import { scheduleConfigChangeInstruction } from "../instructions/ScheduleConfigChange.js";
import { permissionChangeId, permissionValueHash, type PermissionValue } from "./Value.js";

export interface PermissionGrant {
    readonly subject: string;
    readonly scopeKind: number;
    readonly scopeKey: string;
    readonly roleBits: bigint;
    readonly expiryUnixTimestamp?: bigint;
}

export async function grantPermission(context: DevnetContext, grant: PermissionGrant): Promise<string> {
    const subject = normalizePublicKey(grant.subject);
    const scopeKey = normalizePublicKey(grant.scopeKey);
    if (subject === ZERO_ADDRESS) throw new Error("Permission subject must be nonzero");
    const activeRoles = BigInt(getChanceryConstant("role.ACTIVE_ROLE_MASK").value);
    if (grant.roleBits <= 0n || (grant.roleBits & ~activeRoles) !== 0n) throw new Error("Permission grant contains unsupported or inactive roles");
    if (!CHANCERY_SCHEMA.constants.some((constant) => constant.name.startsWith("scope.") && Number(constant.value) === grant.scopeKind)) throw new Error("Permission scope is unsupported by the reference schema");
    const record = derivePermissionRecordAddress(subject, grant.scopeKind, scopeKey);
    const current = await readChanceryAccount(context.rpc, record.address, "PermissionRecord");
    const now = (await context.rpc.getClock("confirmed")).unixTimestamp;
    let oldRoles = 0n;
    let oldGeneration = 0n;
    let oldExpiry = 0n;
    if (current !== null) {
        if (requirePublicKeyField(current, "subject") !== subject || requirePublicKeyField(current, "scope_key") !== scopeKey
            || requireNumberField(current, "scope_kind") !== grant.scopeKind || requireNumberField(current, "bump") !== record.bump) {
            throw new Error("Existing permission identity differs from its canonical PDA");
        }
        if (requireBigIntField(current, "permission_flags") !== 0n) throw new Error("Existing permission is paused; update its pause state before granting roles");
        if (requireNumberField(current, "role_schema_version") !== Number(getChanceryConstant("role.PERMISSION_ROLE_SCHEMA_VERSION").value)) throw new Error("Existing permission role schema is unsupported");
        const words = requireBigIntArrayField(current, "role_bits", 2);
        oldRoles = words[0]! | (words[1]! << 64n);
        oldGeneration = requireBigIntField(current, "permission_generation");
        oldExpiry = requireBigIntField(current, "expiry_unix_timestamp");
        if (grant.expiryUnixTimestamp !== undefined && grant.expiryUnixTimestamp !== oldExpiry) throw new Error("Role grants preserve the existing permission expiry");
    }
    const expiry = current === null ? grant.expiryUnixTimestamp ?? 0n : oldExpiry;
    if (expiry < 0n || (expiry !== 0n && expiry <= now)) throw new Error("Permission expiry must be zero or in the future");
    const newRoles = oldRoles | grant.roleBits;
    if (current !== null && newRoles === oldRoles) return record.address;
    const oldValue: PermissionValue = { subject, scopeKind: grant.scopeKind, scopeKey, roleBits: oldRoles,
        permissionGeneration: oldGeneration, expiryUnixTimestamp: oldExpiry };
    const newValue: PermissionValue = { ...oldValue, roleBits: newRoles, permissionGeneration: oldGeneration + 1n, expiryUnixTimestamp: expiry };
    const dangerousRoles = BigInt(getChanceryConstant("role.DANGEROUS_PERMISSION_ROLE_MASK").value);
    if ((newRoles & dangerousRoles) !== 0n && (grant.scopeKind === SCOPE.GLOBAL || expiry === 0n)) throw new Error("Dangerous roles require a scoped permission with a finite expiry");
    const riskClass = (newRoles & dangerousRoles) === 0n ? 2 : 4;
    const governance = controllerAuthority(0);
    const oldHash = permissionValueHash(record.address, riskClass, oldValue);
    const newHash = permissionValueHash(record.address, riskClass, newValue);
    const nonce = randomBytes(8).readBigUInt64LE();
    const pending = derivePendingConfigChangeAddress(permissionChangeId(record.address, newHash, governance, nonce)).address;
    const proposal = buildChanceryInstruction("propose_config_change", {
        change_kind: 5, risk_class: riskClass, target_account: record.address, old_value_hash: oldHash, new_value_hash: newHash,
        executable_after_unix_timestamp: 0n, expires_at_unix_timestamp: 0n, proposer_nonce: nonce,
    }, { activation_state: knownPdaAddress("module_activation_state"), pending, payer: context.signer.publicKey, governance_authority: governance });
    await submitInstructions(context, "permission-propose", [scheduleConfigChangeInstruction(context.signer.publicKey, proposal)]);
    const proposed = await readChanceryAccount(context.rpc, pending, "PendingConfigChange");
    if (proposed === null || requireNumberField(proposed, "status") !== 1) throw new Error("Proposed permission change is missing: " + pending);
    const executableAfter = requireBigIntField(proposed, "executable_after_unix_timestamp");
    const expiresAt = requireBigIntField(proposed, "expires_at_unix_timestamp");
    const deadline = Date.now() + 30_000;
    while ((await context.rpc.getClock("confirmed")).unixTimestamp < executableAfter) {
        if (Date.now() >= deadline) throw new Error("Permission timelock wait timed out: " + pending);
        await delay(500);
    }
    if ((await context.rpc.getClock("confirmed")).unixTimestamp >= expiresAt) throw new Error("Permission proposal expired: " + pending);
    const accept = buildChanceryInstruction("accept_config_change", {}, {
        activation_state: knownPdaAddress("module_activation_state"), pending, governance_authority: governance,
    });
    await submitInstructions(context, "permission-accept", [executeChanceryInstruction(context.signer.publicKey, accept)]);
    const apply = buildChanceryInstruction("upsert_permission_with_pending_change", {
        subject, scope_kind: grant.scopeKind, scope_key: scopeKey,
        role_bits: [newRoles & ((1n << 64n) - 1n), newRoles >> 64n], expiry_unix_timestamp: expiry,
    }, {
        pending, permission_record: record.address, payer: context.signer.publicKey, granting_authority: governance,
        governance_authority: governance, rent_refund_recipient: context.signer.publicKey,
        counterparty_daily_usage_window: deriveUsageWindowAddress(dimensionScopeHash(SCOPE.COUNTERPARTY, subject), WINDOW_KIND.DAILY).address,
        executor_daily_usage_window: deriveUsageWindowAddress(dimensionScopeHash(SCOPE.EXECUTOR, subject), WINDOW_KIND.DAILY).address,
    });
    await submitInstructions(context, "permission-grant", [executeChanceryInstruction(context.signer.publicKey, apply)]);
    const observed = await readChanceryAccount(context.rpc, record.address, "PermissionRecord");
    if (observed === null) throw new Error("Granted permission is missing: " + record.address);
    const observedRoles = requireBigIntArrayField(observed, "role_bits", 2);
    if ((observedRoles[0]! | (observedRoles[1]! << 64n)) !== newRoles
        || requireBigIntField(observed, "permission_generation") !== newValue.permissionGeneration
        || requireBigIntField(observed, "expiry_unix_timestamp") !== expiry
        || requireBigIntField(observed, "permission_flags") !== 0n) throw new Error("Permission readback differs from the requested grant");
    return record.address;
}
