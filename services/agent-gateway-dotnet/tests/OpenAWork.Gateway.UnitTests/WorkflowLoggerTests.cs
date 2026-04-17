using OpenAWork.Gateway.Contracts.Observability;
using OpenAWork.Gateway.Infrastructure.Observability;

namespace OpenAWork.Gateway.UnitTests;

public sealed class WorkflowLoggerTests
{
    [Fact]
    public void Render_ShouldKeepTreeStructure()
    {
        var logger = new WorkflowLogger();
        var context = new RequestContext(
            RequestId: "req-1",
            Method: "GET",
            Path: "/health",
            Ip: "127.0.0.1",
            UserAgent: "xunit",
            StartTimeUtc: DateTimeOffset.UtcNow);

        var requestStep = logger.Start("request.handle");
        var child = logger.StartChild(requestStep, "mediatr.GetHealthQuery");
        logger.Succeed(child, "handled");
        logger.Succeed(requestStep, "ok");

        var rendered = logger.Render(context, 200);

        Assert.Contains("requestId: req-1", rendered);
        Assert.Contains("workflow:", rendered);
        Assert.Contains("request.handle", rendered);
        Assert.Contains("mediatr.GetHealthQuery", rendered);
        Assert.Contains("ip: 127.0.0.1", rendered);
    }
}
