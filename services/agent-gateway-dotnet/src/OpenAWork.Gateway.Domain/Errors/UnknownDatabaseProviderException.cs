using OpenAWork.Gateway.Domain.Persistence;

namespace OpenAWork.Gateway.Domain.Errors;

public sealed class UnknownDatabaseProviderException(string? provider)
    : GatewayDomainException($"Unknown database provider '{provider ?? "<null>"}'. Supported providers: {string.Join(", ", Enum.GetNames<DatabaseProviderKind>())}.")
{
    public string? Provider { get; } = provider;
}
