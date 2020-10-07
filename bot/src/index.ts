import "dotenv/config";
import Eris from "eris";
import { cleanUpOldSessions } from "./actions";
import { connectToDatabase } from "./database";
import { onMessageCreated, onReactionAdded, onVoiceChange, onVoiceJoin, onVoiceLeave } from "./listeners";

const intents = Eris.Constants.Intents;

(async () => {
    console.log("[+] Starting impostor...");

    await connectToDatabase();

    console.log("[+] Connected to database!");

    const bot = new Eris.Client(process.env.DISCORD_TOKEN as string, {
        intents: intents.guilds | intents.guildVoiceStates | intents.guildMessages | intents.guildMessageReactions,
        messageLimit: 5,
    });

    await bot.connect();
    await new Promise(r => bot.once("ready", r));

    await bot.editStatus("online", {
        name: "!amongus help",
        type: 0,
    });

    await cleanUpOldSessions(bot);

    bot.on("messageCreate", onMessageCreated.bind(null, bot));
    bot.on("messageReactionAdd", onReactionAdded.bind(null, bot));
    bot.on("voiceChannelJoin", onVoiceJoin);
    bot.on("voiceChannelLeave", onVoiceLeave);
    bot.on("voiceChannelSwitch", onVoiceChange);

    bot.on("error", e => {
        console.log(`[-] Got Discord error: '${e}'. Attempting to reconnect...`);
    });

    console.log("[+] Connected to Discord as " + bot.user.username);
})();
