using System;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace client
{
    public static class Client
    {
        public static async Task Main(string[] args)
        {
            var client = new AmongUsClient();

            client.OnConnect += () => WriteMessage(new {type = "connect"});
            client.OnDisconnect += () =>
            {
                WriteMessage(new {type = "disconnect"});
                Environment.Exit(0);
            };
            client.OnTalkingEnd += () => WriteMessage(new {type = "talkingEnd"});
            client.OnTalkingStart += () => WriteMessage(new {type = "talkingStart"});
            client.OnGameEnd += () => WriteMessage(new {type = "gameEnd"});
            client.OnPlayerDataUpdate += data => WriteMessage(new {type = "gameData", data});

            try
            {
                await client.Connect(IPAddress.Parse(args[0]), args[1]);
            }
            catch (AUException ex)
            {
                WriteMessage(new {type = "error", message = ex.Message});
                return;
            }

            // Trap ctrlc (SIGINT) to disconnect before terminating.
            Console.CancelKeyPress += (sender, ev) =>
            {
                ev.Cancel = true; // cancel direct shutdown, so we can disconnect and then kill ourselves
                client.DisconnectAndExit();
            };

            // Idle endlessly.
            while (true)
            {
                await Task.Delay(30000);
            }
        }

        private static void WriteMessage(object obj)
        {
            Console.Out.WriteLine(JsonConvert.SerializeObject(obj));
            Console.Out.Flush();
        }
    }
}