namespace OpenAWork.Gateway.Contracts.Auth;

public sealed record RefreshResponse(
    string AccessToken,
    string RefreshToken,
    string ExpiresIn);
