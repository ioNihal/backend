import type { Server, Socket } from "socket.io";
import type { PlayerState } from "../state.js";

/**
 * Context passed to every command handler.
 */
export type CommandContext = {
    io: Server;
    socket: Socket;
    player: PlayerState;
};

/**
 * A command handler function.
 * @param ctx  — the io/socket/player context
 * @param args — the arguments after the command name (already split by whitespace)
 */
export type CommandHandler = (ctx: CommandContext, args: string[]) => Promise<void> | void;

/**
 * Registry of all slash commands.
 * Key = command name (lowercase, without the leading slash).
 * Value = { handler, description, usage }
 */
type CommandEntry = {
    handler: CommandHandler;
    description: string;
    usage: string;
};

const registry = new Map<string, CommandEntry>();

/**
 * Register a new command.
 */
export function registerCommand(
    name: string,
    handler: CommandHandler,
    description: string,
    usage: string
): void {
    registry.set(name.toLowerCase(), { handler, description, usage });
}

/**
 * Try to dispatch a command from a raw message string.
 * Returns true if it was a command (regardless of whether it succeeded),
 * false if the message is not a command (doesn't start with `/`).
 */
export async function dispatchCommand(ctx: CommandContext, rawMessage: string): Promise<boolean> {
    if (!rawMessage.startsWith("/")) return false;

    const parts = rawMessage.slice(1).trim().split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    if (!commandName) return false;

    const entry = registry.get(commandName);
    if (!entry) {
        ctx.socket.emit("chat", {
            channel: "error",
            name: "SYSTEM",
            message: `Unknown command: /${commandName}. Type /help to see available commands.`,
        });
        return true;
    }

    try {
        await entry.handler(ctx, parts.slice(1));
    } catch (err) {
        console.error(`[Command Error] /${commandName}:`, err);
        ctx.socket.emit("chat", {
            channel: "error",
            name: "SYSTEM",
            message: "An internal error occurred while processing your command.",
        });
    }

    return true;
}

/**
 * Get all registered commands for the /help listing.
 */
export function getAllCommands(): { name: string; description: string; usage: string }[] {
    const result: { name: string; description: string; usage: string }[] = [];
    for (const [name, entry] of registry) {
        result.push({ name, description: entry.description, usage: entry.usage });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
}
