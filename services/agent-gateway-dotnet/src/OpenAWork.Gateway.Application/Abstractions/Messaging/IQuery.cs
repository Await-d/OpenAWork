namespace OpenAWork.Gateway.Application.Abstractions.Messaging;

public interface IQuery<TResponse> : MediatR.IRequest<TResponse>;
