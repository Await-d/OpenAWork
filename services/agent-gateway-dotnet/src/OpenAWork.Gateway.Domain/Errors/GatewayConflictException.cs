namespace OpenAWork.Gateway.Domain.Errors;

public sealed class GatewayConflictException(string message) : GatewayDomainException(message);
