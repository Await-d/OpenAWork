namespace OpenAWork.Gateway.Contracts.Auth;

public sealed record RegisterRequest(
    string? Email,
    string? Password);
