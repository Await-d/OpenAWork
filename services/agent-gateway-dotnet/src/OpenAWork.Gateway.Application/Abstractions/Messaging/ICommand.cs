namespace OpenAWork.Gateway.Application.Abstractions.Messaging;

public interface ICommand<TResponse> : MediatR.IRequest<TResponse>;
