using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Hazel;
using Hazel.Udp;

namespace client
{
    public static class Extensions
    {
        /**
         * Helper method that fetches a new Reliable message writer for the specified connection,
         * invokes the specified write method, then sends the resulting message to the server.
         * Any errors during message sending will be ignored.
         */
        public static void SendReliableMessage(this UdpClientConnection connection, Action<MessageWriter> write)
        {
            var writer = MessageWriter.Get(SendOption.Reliable);
            write(writer);
            try { connection.Send(writer); } catch { /* Ignored */ }
            writer.Recycle();
        }

        /**
         * Returns an iterator that invokes `ReadMessage` on the passed MessageReader while
         * there are still messages left in the buffer.
         */
        public static IEnumerable<MessageReader> Messages(this MessageReader reader)
        {
            while (reader.Position < reader.Length)
            {
                yield return reader.ReadMessage();
            }
        }
    }
    
    // Extensions that allow a WaitHandle to be awaited.
    // Source: https://stackoverflow.com/questions/18756354/wrapping-manualresetevent-as-awaitable-task
    public static class WaitHandleExtensions
    {
        public static Task AsTask(this WaitHandle handle)
        {
            return AsTask(handle, Timeout.InfiniteTimeSpan);
        }

        public static Task AsTask(this WaitHandle handle, TimeSpan timeout)
        {
            var tcs = new TaskCompletionSource<object>();
            var registration = ThreadPool.RegisterWaitForSingleObject(handle, (state, timedOut) =>
            {
                var localTcs = (TaskCompletionSource<object>)state;
                if (timedOut)
                    localTcs.TrySetCanceled();
                else
                    localTcs.TrySetResult(null);
            }, tcs, timeout, executeOnlyOnce: true);
            tcs.Task.ContinueWith((_, state) => ((RegisteredWaitHandle)state).Unregister(null), registration, TaskScheduler.Default);
            return tcs.Task;
        }
    }
}