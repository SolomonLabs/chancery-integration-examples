from __future__ import annotations

import base64
import json

from .model import InstructionSpec


def instruction_to_document(instruction: InstructionSpec) -> dict[str, object]:
    return {
        "programId": instruction.program_id,
        "accounts": [
            {
                "name": account.name,
                "address": account.address,
                "isSigner": account.is_signer,
                "isWritable": account.is_writable,
            }
            for account in instruction.accounts
        ],
        "dataBase64": base64.b64encode(instruction.data).decode("ascii"),
        "dataHex": instruction.data.hex(),
    }


def serialize_instruction(instruction: InstructionSpec) -> str:
    return json.dumps(instruction_to_document(instruction), indent=2) + "\n"
