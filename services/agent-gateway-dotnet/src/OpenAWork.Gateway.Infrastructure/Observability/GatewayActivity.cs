using System.Diagnostics;

namespace OpenAWork.Gateway.Infrastructure.Observability;

public static class GatewayActivity
{
    public static readonly ActivitySource Source = new("OpenAWork.Gateway.DotNet");
}
