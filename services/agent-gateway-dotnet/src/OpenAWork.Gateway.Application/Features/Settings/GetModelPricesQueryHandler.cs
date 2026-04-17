using MediatR;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetModelPricesQueryHandler : IRequestHandler<GetModelPricesQuery, ModelPricesResponse>
{
    private static readonly IReadOnlyList<ModelPriceItem> BuiltinPrices =
    [
        new("claude-opus-4-5", 15.0m, 75.0m),
        new("claude-3-5-sonnet-20241022", 3.0m, 15.0m),
        new("claude-3-5-haiku-20241022", 0.8m, 4.0m),
        new("gpt-4o", 2.5m, 10.0m),
        new("gpt-4o-mini", 0.15m, 0.6m),
        new("deepseek-chat", 0.27m, 1.1m),
        new("deepseek-reasoner", 0.55m, 2.19m),
        new("qwen-max", 0.4m, 1.2m),
    ];

    public Task<ModelPricesResponse> Handle(GetModelPricesQuery request, CancellationToken cancellationToken)
    {
        return Task.FromResult(new ModelPricesResponse(BuiltinPrices));
    }
}
