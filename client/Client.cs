using System;
using System.Net;
using System.Threading.Tasks;

namespace client
{
    public static class Client
    {
        public static async Task Main()
        {
            var client = new AmongUsClient();

            client.OnConnect += () => Console.WriteLine("Connected!");
            client.OnDisconnect += () => Console.WriteLine("Disconnected!");
            client.OnTalkingEnd += () => Console.WriteLine("Stop talking!");
            client.OnTalkingStart += () => Console.WriteLine("Start talking!");

            try
            {
                await client.Connect(IPAddress.Parse("172.105.251.170"), "IGNRWQ");
            }
            catch (AUException ex)
            {
                Console.WriteLine("Error during startup: " + ex.Message);
            }

            // Idle endlessly.
            while (true)
            {
                await Task.Delay(30000);
            }
        }
    }
}