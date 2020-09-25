import eris from "eris";
import { createEmptyNewSession } from "./actions";
import { LobbyRegion } from "./constants";
import startSession from "./session-runner";

const COMMAND_PREFIX = "!amongus ";
const V2 = "QWXRTYLPESDFGHUJKZOCVBINMA";

export async function onMessageCreated(bot: eris.Client, msg: eris.Message) {
    if (!msg.content.startsWith(COMMAND_PREFIX) || msg.author.bot) return;
    if (!(msg.channel instanceof eris.TextChannel)) return;

    try {
        const { region, code } = parseCommandInvocation(msg.content);

        const session = await createEmptyNewSession(msg, region, code);
        await startSession(bot, session);
    } catch (e) {
        await msg.channel.createMessage(`<@!${msg.author.id}>, sorry but something went wrong: ${e}`).catch(() => {});
    }
}

/**
 * Attempts to parse the region from the specified command invocation,
 * including the command prefix. Returns the parsed region and the code,
 * or throws an error if it could not be parsed.
 */
function parseCommandInvocation(msg: string): { region: LobbyRegion; code: string } {
    msg = msg.slice(COMMAND_PREFIX.length);

    let region: LobbyRegion | null = null;

    const nextWord = msg.slice(0, msg.indexOf(" "));

    if (nextWord === "asia" || nextWord === "as") {
        region = LobbyRegion.ASIA;
        msg = msg.slice(nextWord.length);
    }

    if (nextWord === "eu" || nextWord === "europe") {
        region = LobbyRegion.EUROPE;
        msg = msg.slice(nextWord.length);
    }

    if (
        nextWord === "us" ||
        nextWord === "usa" ||
        nextWord === "na" ||
        nextWord === "america" ||
        nextWord === "northamerica"
    ) {
        region = LobbyRegion.NORTH_AMERICA;
        msg = msg.slice(nextWord.length);
    }

    if (nextWord === "north") {
        msg = msg.slice(nextWord.length).trim();

        const nextNextWord = msg.slice(0, msg.indexOf(" "));
        if (nextNextWord === "america") {
            region = LobbyRegion.NORTH_AMERICA;
            msg = msg.slice(nextNextWord.length);
        }
    }

    if (!region) {
        throw (
            "Could not determine the region of the lobby. Try doing `" +
            COMMAND_PREFIX +
            "na ABCDEF` or `" +
            COMMAND_PREFIX +
            "europe GHIJKL`."
        );
    }

    return {
        region,
        code: validateLobbyCode(msg),
    };
}

/**
 * Verifies the specified string as a lobby code. If it is valid, returns
 * the code. Else, throws an error.
 */
function validateLobbyCode(code: string) {
    code = code.trim().toUpperCase();

    if (code.length !== 6) {
        throw "Invalid lobby code. The lobby code must be exactly 6 letters.";
    }

    if ([...code].some(x => !V2.includes(x))) {
        throw "Invalid lobby code. The lobby code contains invalid characters.";
    }

    return code;
}
