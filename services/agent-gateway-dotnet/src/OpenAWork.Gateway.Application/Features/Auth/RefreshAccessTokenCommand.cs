using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Auth;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed record RefreshAccessTokenCommand(string RefreshToken) : ICommand<RefreshResponse>;
