using System;
using System.Net;
using System.Threading.Tasks;
using Hazel;
using Hazel.Udp;

namespace client
{
    /**
     * Class that encapsulates a simple "invisible" Among Us client that connects to the
     * specified server and lobby. Will emit messages to stdout on various events, in
     * particular situations where talking is (no longer) allowed, as well as error situations.
     */
    public class AmongUsClient
    {
        // Represents a handshake of the latest version with name set to "Impostor".
        private static readonly byte[] HANDSHAKE =
            {0x46, 0xD2, 0x02, 0x03, 0x08, 0x49, 0x6D, 0x70, 0x6F, 0x73, 0x74, 0x6F, 0x72};

        // The port to the Among Us matchmaker.
        private const ushort MATCHMAKER_PORT = 22023;

        private uint _hostId; // the mm ID of the host of the current lobby
        private uint _clientId; // the mm ID of ourselves

        private IPAddress _address; // the address of the server we're connected to
        private ushort _port; // the port we're connected to
        private string _lobbyName; // the name of the lobby we're connected to
        private int _lobbyCode; // the code of the lobby we're connected to

        private UdpClientConnection _connection; // the connection to the lobby

        /// <summary>
        /// Fired when the client connects to the server. Note that this may be fired
        /// multiple times
        /// </summary>
        public event Action OnConnect;

        /// <summary>
        /// Fired when the client disconnects from the server outside of the first
        /// connection attempt, such as when everyone has left the lobby.
        /// </summary>
        public event Action OnDisconnect;

        /// <summary>
        /// Fired in moments when talking should be allowed, such as when voting starts.
        /// Note: does not fire when a game ends, you need OnGameEnd for that.
        /// </summary>
        public event Action OnTalkingStart;

        /// <summary>
        /// Fired when the game transitions from a state where talking is allowed to one
        /// where talking is not allowed, such as on game start or after a vote.
        /// </summary>
        public event Action OnTalkingEnd;

        /// <summary>
        /// Fired after a single game has ended and the bot is back in the lobby. This is
        /// a separate event from talking start.
        /// </summary>
        public event Action OnGameEnd;

        /// <summary>
        /// Initializes this client by connecting to the specified host and attempting
        /// to join the specified lobby code. Will throw if connection fails, else will
        /// start servicing messages in the background. The caller is responsible for
        /// ensuring that the application stays running as long as the client is active.
        /// </summary>
        public async Task Connect(IPAddress address, string lobbyName, ushort port = MATCHMAKER_PORT)
        {
            _address = address;
            _lobbyName = lobbyName;
            _lobbyCode = GameCode.GameNameToIntV2(lobbyName);

            var (connection, response) = await ConnectToMMAndSend(address, port, JoinGame);
            _port = (ushort) connection.EndPoint.Port;

            _connection = connection;
            _connection.DataReceived += OnMessageReceived;
            _connection.Disconnected += (sender, args) => { OnDisconnect?.Invoke(); };

            HandleJoinGameResult(response);

            OnConnect?.Invoke();
        }

        /// <summary>
        /// Writes a join game request to the specified message writer.
        /// </summary>
        private void JoinGame(MessageWriter writer)
        {
            writer.StartMessage((byte) MMTags.JoinGame);
            writer.Write(_lobbyCode);
            writer.WritePacked(0x7); // map ownership flags
            writer.EndMessage();
        }

        /// <summary>
        /// Handles the result of attempting to join the game. This will throw if something is wrong, else
        /// it will assign the host/client id as appropriate and return normally.
        /// </summary>
        private void HandleJoinGameResult(MessageReader response)
        {
            // If the response isn't joined game, we have a problem.
            if (response.Tag != (byte) MMTags.JoinedGame)
            {
                // If it isn't JoinGame (which has a disconnect reason) just disconnect with unknown.
                if (response.Tag != (byte) MMTags.JoinGame)
                    throw new AUException("Connecting to the Among Us servers failed with an unknown error.");

                var reason = (DisconnectReasons) response.ReadInt32();

                if (reason == DisconnectReasons.GameNotFound)
                {
                    throw new AUException(
                        "Could not join the lobby because the game was not found. Please double-check the lobby code and region.");
                }

                if (reason == DisconnectReasons.GameFull)
                {
                    throw new AUException(
                        "Could not join the lobby because it was full. Remember that the bot also takes up a space!");
                }

                if (reason == DisconnectReasons.GameStarted)
                {
                    throw new AUException(
                        "Could not join the lobby because the game is already in progress. Please try again after this round is finished.");
                }

                if (reason == DisconnectReasons.Custom)
                {
                    var text = response.ReadString();
                    throw new AUException($"Could not join the lobby: '{text}'");
                }

                throw new AUException($"Could not join the lobby due to an unknown error: {reason}");
            }

            // We're fine!
            response.ReadInt32(); // game id
            _clientId = response.ReadUInt32(); // local client id
            _hostId = response.ReadUInt32(); // host id
        }

        /// <summary>
        /// Invoked when we receive a message from the matchmaking server.
        /// </summary>
        private void OnMessageReceived(DataReceivedEventArgs args)
        {
            foreach (var message in args.Message.Messages())
            {
                HandleMessage(message);
            }
        }

        /// <summary>
        /// Invoked for each message in the batch passed to `OnMessageReceived`.
        /// </summary>
        private void HandleMessage(MessageReader message)
        {
            if (message.Tag == (byte) MMTags.GameData || message.Tag == (byte) MMTags.GameDataTo)
            {
                message.ReadInt32(); // game id

                // Parse targetId field if GameDataTo.
                if (message.Tag == (byte) MMTags.GameDataTo && message.ReadPackedInt32() != _clientId)
                    return;

                foreach (var gameDataMessage in message.Messages())
                {
                    HandleGameData(gameDataMessage);
                }
            }
            else if (message.Tag == (byte) MMTags.StartGame)
            {
                HandleStartGame(message);
            }
            else if (message.Tag == (byte) MMTags.EndGame)
            {
                HandleEndGame(message);
            }
            else if (message.Tag == (byte) MMTags.RemovePlayer)
            {
                HandleRemovePlayer(message);
            }
        }

        /// <summary>
        /// Invoked for each data packet that contains game data. Checks if this is an RPC,
        /// and if yes acts accordingly.
        /// </summary>
        private void HandleGameData(MessageReader reader)
        {
            if (reader.Tag != (byte) GameDataTags.Rpc) return;

            var target = reader.ReadPackedInt32();
            var action = (RPCCalls) reader.ReadByte();

            if (action == RPCCalls.Close)
            {
                OnTalkingEnd?.Invoke();
            }
            else if (action == RPCCalls.StartMeeting)
            {
                OnTalkingStart?.Invoke();
            }
        }

        /// <summary>
        /// Invoked when the game has been started.
        /// </summary>
        private void HandleStartGame(MessageReader message)
        {
            OnTalkingEnd?.Invoke();

            _connection.SendReliableMessage(writer =>
            {
                writer.StartMessage((byte) MMTags.GameData);
                writer.Write(_lobbyCode);

                writer.StartMessage((byte) GameDataTags.Ready);
                writer.WritePacked(_clientId);
                writer.EndMessage();

                writer.EndMessage();
            });
        }

        /// <summary>
        /// Invoked when the game has ended. Attempts to rejoin the same lobby.
        /// </summary>
        private void HandleEndGame(MessageReader message)
        {
            OnGameEnd?.Invoke();

            // Simply rejoin the same lobby.
            _connection.SendReliableMessage(JoinGame);
        }

        /// <summary>
        /// Invoked when a player left the lobby. Handles situations where we
        /// end up becoming the host.
        /// </summary>
        private async void HandleRemovePlayer(MessageReader reader)
        {
            reader.ReadInt32(); // room code
            reader.ReadInt32(); // id that left
            var newHost = reader.ReadUInt32();
            reader.ReadByte(); // disconnect reason

            _hostId = newHost;

            // If we're the host now, leave and attempt to rejoin to make someone else host.
            if (newHost == _clientId)
            {
                _connection.RemoveDisconnectListeners();
                _connection.Disconnect("I don't want to be the host");

                try
                {
                    await Connect(_address, _lobbyName, _port);
                }
                catch
                {
                    OnDisconnect?.Invoke();
                }
            }
        }

        /// <summary>
        /// Connect to the specified ip:port endpoint for the matchmaker, then send the specified
        /// message. Returns a task that resolves to a tuple of the established connection and the
        /// first message received from the matchmaker in response to the sent message (usually
        /// the join/host confirmal message). Will throw if the connection closes prematurely or
        /// otherwise errors. Otherwise, the task itself is responsible for disposing of the
        /// connection once the server disconnects.
        /// </summary>
        private static async Task<(UdpClientConnection, MessageReader)> ConnectToMMAndSend(IPAddress address,
            ushort port, Action<MessageWriter> writeMessage)
        {
            var firstMessageTask = new TaskCompletionSource<MessageReader>();

            var connection = new UdpClientConnection(new IPEndPoint(address, port));
            connection.KeepAliveInterval = 1000;
            connection.DisconnectTimeout = 10000;
            connection.ResendPingMultiplier = 1.2f;

            // Set up an event handler to resolve the task on first non-reselect message received.
            Action<DataReceivedEventArgs> onDataReceived = null;
            onDataReceived = args =>
            {
                var msg = args.Message.ReadMessage();
                if (msg.Tag == (byte) MMTags.ReselectServer) return; // not interested

                firstMessageTask.TrySetResult(msg);
                connection.DataReceived -= onDataReceived;
            };
            connection.DataReceived += onDataReceived;

            // Set up an event handler to set an exception for the task on early disconnect.
            connection.Disconnected += (sender, args) =>
            {
                connection.Dispose();
                firstMessageTask.TrySetException(new AUException("Connection to matchmaker prematurely exited"));
            };

            // Connect to the endpoint.
            connection.ConnectAsync(HANDSHAKE);
            await connection.ConnectWaitLock.AsTask();

            // Send the contents.
            connection.SendReliableMessage(writeMessage);

            // Wait for the response to arrive.
            var response = await firstMessageTask.Task;

            // If this is not a redirect, return the result.
            if (response.Tag != (byte) MMTags.Redirect)
            {
                return (connection, response);
            }

            // This is a redirect, so do this again but with the new data.
            var newIp = response.ReadUInt32();
            var newPort = response.ReadUInt16();

            // Reconnect to new host.
            return await ConnectToMMAndSend(new IPAddress(newIp), newPort, writeMessage);
        }
    }
}