using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Messaging;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Behaviors;

namespace OpenAWork.Gateway.UnitTests;

public sealed class TransactionBehaviorTests
{
    [Fact]
    public async Task Command_ShouldUseTransactionRunner()
    {
        var runner = new FakeTransactionRunner();
        var behavior = new TransactionBehavior<TestCommand, string>(runner);

        var result = await behavior.Handle(new TestCommand(), _ => Task.FromResult("ok"), CancellationToken.None);

        Assert.Equal("ok", result);
        Assert.Equal(1, runner.ExecutionCount);
    }

    [Fact]
    public async Task Query_ShouldBypassTransactionRunner()
    {
        var runner = new FakeTransactionRunner();
        var behavior = new TransactionBehavior<TestQuery, string>(runner);

        var result = await behavior.Handle(new TestQuery(), _ => Task.FromResult("ok"), CancellationToken.None);

        Assert.Equal("ok", result);
        Assert.Equal(0, runner.ExecutionCount);
    }

    private sealed record TestCommand : ICommand<string>;

    private sealed record TestQuery : IQuery<string>;

    private sealed class FakeTransactionRunner : ICommandTransactionRunner
    {
        public int ExecutionCount { get; private set; }

        public Task<TResponse> ExecuteAsync<TResponse>(Func<CancellationToken, Task<TResponse>> operation, CancellationToken cancellationToken)
        {
            ExecutionCount++;
            return operation(cancellationToken);
        }
    }
}
