using System.Security.Cryptography;
using System.Text;
using OpenAWork.Gateway.Application.Abstractions.Auth;

namespace OpenAWork.Gateway.Infrastructure.Auth;

public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const string Prefix = "pbkdf2";
    private const int Iterations = 210000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public string HashPassword(string value)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(value, salt, Iterations, HashAlgorithmName.SHA256, HashSize);

        return string.Join('$',
            Prefix,
            Iterations.ToString(),
            Convert.ToBase64String(salt),
            Convert.ToBase64String(hash));
    }

    public bool Verify(string value, string storedHash)
    {
        if (storedHash.StartsWith($"{Prefix}$", StringComparison.Ordinal))
        {
            var parts = storedHash.Split('$', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 4 || !int.TryParse(parts[1], out var iterations) || iterations <= 0)
            {
                return false;
            }

            try
            {
                var salt = Convert.FromBase64String(parts[2]);
                var expectedHash = Convert.FromBase64String(parts[3]);
                var actualHash = Rfc2898DeriveBytes.Pbkdf2(value, salt, iterations, HashAlgorithmName.SHA256, expectedHash.Length);
                return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
            }
            catch (FormatException)
            {
                return false;
            }
        }

        var legacyHash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        var legacyHashText = Convert.ToHexString(legacyHash).ToLowerInvariant();
        var storedBytes = Encoding.UTF8.GetBytes(storedHash);
        var actualBytes = Encoding.UTF8.GetBytes(legacyHashText);
        return storedBytes.Length == actualBytes.Length && CryptographicOperations.FixedTimeEquals(actualBytes, storedBytes);
    }

    public bool NeedsRehash(string storedHash)
    {
        if (!storedHash.StartsWith($"{Prefix}$", StringComparison.Ordinal))
        {
            return true;
        }

        var parts = storedHash.Split('$', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length != 4 || !int.TryParse(parts[1], out var iterations) || iterations != Iterations;
    }
}
