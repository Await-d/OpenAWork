using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Health;

namespace OpenAWork.Gateway.Application.Features.Health;

public sealed record GetHealthQuery : IQuery<HealthResponse>;
