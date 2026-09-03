interface JsonParseContext {
    readonly source: string;
}

type JsonParseReviver = (
    this: unknown,
    key: string,
    value: unknown,
    context: JsonParseContext,
) => unknown;

const parseJsonWithSource = JSON.parse as unknown as (
    text: string,
    reviver: JsonParseReviver,
) => unknown;

const DECIMAL_INTEGER = /^-?(0|[1-9][0-9]*)$/;

export function parseJsonRpcResponse(text: string): unknown {
    return parseJsonWithSource(
        text,
        function reviveUnsafeInteger(
            _key: string,
            value: unknown,
            context: JsonParseContext,
        ): unknown {
            if (
                typeof value === "number"
                && Number.isInteger(value)
                && !Number.isSafeInteger(value)
                && DECIMAL_INTEGER.test(context.source)
            ) {
                return BigInt(context.source);
            }
            return value;
        },
    );
}
