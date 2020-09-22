using System;

namespace client
{
    /**
     * Represents an exception thrown during Among Us client operations.
     */
    public class AUException : Exception
    {
        public AUException(string message) : base(message)
        {
        }

        public AUException(string message, Exception innerException) : base(message, innerException)
        {
        }
    }
}