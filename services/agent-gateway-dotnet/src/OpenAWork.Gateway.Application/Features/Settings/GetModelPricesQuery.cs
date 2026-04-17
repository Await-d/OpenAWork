using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed record GetModelPricesQuery : IQuery<ModelPricesResponse>;
