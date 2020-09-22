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

        /**
         * Connect to the specified ip:port endpoint for the matchmaker, then send the specified
         * message. Returns a task that resolves to a tuple of the established connection and the
         * first message received from the matchmaker in response to the sent message (usually
         * the join/host confirmal message). Will throw if the connection closes prematurely or
         * otherwise errors. Otherwise, the task itself is responsible for disposing of the
         * connection once the server disconnects.
         */
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