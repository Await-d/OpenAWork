using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Contracts.Usage;

namespace OpenAWork.Gateway.Application.Features.Usage;

public sealed record GetUsageRecordsQuery : IQuery<UsageRecordsResponse>;
