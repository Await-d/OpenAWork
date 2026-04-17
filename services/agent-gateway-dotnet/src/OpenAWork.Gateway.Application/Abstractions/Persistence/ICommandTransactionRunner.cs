namespace OpenAWork.Gateway.Application.Abstractions.Persistence;

public interface ICommandTransactionRunner
{
    Task<TResponse> ExecuteAsync<TResponse>(Func<CancellationToken, Task<TResponse>> operation, CancellationToken cancellationToken);
}
