namespace OpenAWork.Gateway.Application.Abstractions.Auth;

public sealed record AuthUser(
    string Id,
    string Email,
    string PasswordHash);
