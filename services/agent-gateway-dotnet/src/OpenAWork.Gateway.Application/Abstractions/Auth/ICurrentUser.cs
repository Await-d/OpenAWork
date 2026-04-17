namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public interface ICurrentUser
{
    bool IsAuthenticated { get; }

    string? UserId { get; }
}
