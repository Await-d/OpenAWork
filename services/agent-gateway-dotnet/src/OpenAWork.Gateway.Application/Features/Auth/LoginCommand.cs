using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Auth;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed record LoginCommand(
    string Email,
    string Password) : ICommand<LoginResponse>;
