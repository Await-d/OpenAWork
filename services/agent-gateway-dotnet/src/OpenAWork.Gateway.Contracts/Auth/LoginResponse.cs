namespace OpenAWork.Gateway.Contracts.Auth;

public sealed record LoginResponse(
    string AccessToken,
    string RefreshToken,
    string ExpiresIn);
