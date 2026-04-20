namespace OpenAWork.Gateway.Contracts.Auth;

public sealed record LoginRequest(
    string? Email,
    string? Password);
