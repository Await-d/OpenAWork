namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface IJwtTokenIssuer
{
    string ExpiresIn { get; }

    string IssueAccessToken(string userId, string email);
}
