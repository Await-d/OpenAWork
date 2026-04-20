namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IPasswordHasher
{
    string HashPassword(string value);

    bool Verify(string value, string storedHash);

    bool NeedsRehash(string storedHash);
}
