<h1><img width=80 height=80 src="https://i.imgur.com/bhMk1fO.png"></td>
Impostor</h1>

[![Discord](https://discordapp.com/api/guilds/249481856687407104/widget.png?style=shield)](https://discord.gg/fQk7CHx)

This is the source code for the Discord bot and Among Us client that compromise Impostor. Note that Impostor is not intended for self-hosting (although it is theoretically possible), so if you want Impostor on your Discord server the easiest solution is to simply click [here](https://discord.com/api/oauth2/authorize?client_id=755520374510321745&permissions=21261392&scope=bot).

# Demo

[![Demo Thumbnail](https://i.imgur.com/ZklHo9L.jpeg)](https://streamable.com/i2a5vh)

# Components

This project consists of two components, creatively named bot and client. Bot is the Discord part written in TypeScript that handles all the logic around command handling, session management, member voice channel moving, etc. Client is a simple C# implementation of the Among Us networking protocol, just barely enough to connect to the lobby, fetch player data and emit events. Bot launches a client instance for every lobby, reading events from client through stdout.

## Developing Bot

To get started with developing the bot, you'll need to install dependencies. First of all you need to have [Node.js](https://nodejs.org) installed. After that, simply run `npm/yarn install` to get all the dependencies needed.

`./node_modules/.bin/tsc -w` will start a watching TypeScript compiler that will automatically compile the TypeScript source to JavaScript. After that, simply configure your `.env` by copying the template and filling in values, then run `node dist/index.js` to start the bot.

Note that you will also need a PostgreSQL database for running the bot.

## Developing Client

For the client, be sure to clone the repository with submodules enabled, then simply open the solution in `client/` to develop. You can also use the dotnet CLI to build the client, using `dotnet build`.

# License

[MIT](http://opensource.org/licenses/MIT)

