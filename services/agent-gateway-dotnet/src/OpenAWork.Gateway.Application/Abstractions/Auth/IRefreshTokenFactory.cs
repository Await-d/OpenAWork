namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IRefreshTokenFactory
{
    string Hash(string token);

    GeneratedRefreshToken Create();
}
