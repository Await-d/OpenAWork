using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;

namespace OpenAWork.Gateway.Application.Behaviors;

public sealed class TransactionBehavior<TRequest, TResponse>(ICommandTransactionRunner transactionRunner)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (request is not ICommand<TResponse>)
        {
            return next();
        }

        return transactionRunner.ExecuteAsync<TResponse>(_ => next(), cancellationToken);
    }
}
