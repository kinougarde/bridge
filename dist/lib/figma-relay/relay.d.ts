export declare const DEFAULT_HTTP_PORT = 9300;
export type Message = Record<string, unknown>;
export interface RelayOptions {
    /** Streamable HTTP endpoint of the shared server. */
    url: string;
    /** Deliver a message to the conversation (stdout). */
    write: (msg: Message) => void;
    /** Resolve once the shared server answers; start it if nobody else is. */
    ensureServer: () => Promise<void>;
    log: (line: string) => void;
}
/** Parse a `text/event-stream` body, calling `onMessage` for each JSON-RPC message. */
export declare function readSse(body: ReadableStream<Uint8Array>, onMessage: (msg: Message) => void, log?: (line: string) => void): Promise<void>;
/**
 * Forwards one conversation's MCP messages to the shared server. When the
 * server drops the session (it closes idle ones after 30 minutes) or restarts,
 * the relay replays the conversation's `initialize` and resends the message,
 * so the conversation never notices.
 */
export declare class Relay {
    private readonly opts;
    private sessionId;
    private protocolVersion;
    private initRequest;
    private recovering;
    private stream;
    private replays;
    private ready;
    constructor(opts: RelayOptions);
    /** Start the shared server early, while the conversation is still connecting. */
    start(): void;
    handle(msg: Message): Promise<void>;
    close(): void;
    private headers;
    private observe;
    private send;
    private recover;
    /** Answer a request the server could not take, so the conversation never hangs on it. */
    private fail;
    /** Server-initiated messages (notifications, requests) arrive on a standalone GET stream. */
    private openStream;
}
export interface ServerControl {
    isUp: () => Promise<boolean>;
    start: () => void;
    /** Taken by the one relay that starts the server, so simultaneous conversations start one. */
    lockPath: string;
}
/** Take the start lock, reclaiming it from a relay that died while holding it. */
export declare function takeLock(lockPath: string): boolean;
export declare function ensureServer(ctl: ServerControl, log: (line: string) => void, timeoutMs?: number): Promise<void>;
/**
 * The keeper: runs figma-console and holds its stdin open. figma-console exits
 * as soon as its stdin closes — that is how it notices a client went away — so
 * a server meant to outlive every conversation needs a stdin nobody closes.
 * Its log goes to a file in the temp directory, rewritten at each start.
 */
export declare function serve(): void;
export declare function main(): void;
//# sourceMappingURL=relay.d.ts.map