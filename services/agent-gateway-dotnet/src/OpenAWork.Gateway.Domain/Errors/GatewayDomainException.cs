namespace OpenAWork.Gateway.Domain.Errors;

public abstract class GatewayDomainException(string message) : Exception(message);
