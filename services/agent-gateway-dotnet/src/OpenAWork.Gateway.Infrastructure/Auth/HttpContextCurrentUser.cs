using Microsoft.AspNetCore.Http;
using System.Security.Claims;
using OpenAWork.Gateway.Application.Abstractions.Auth;

namespace OpenAWork.Gateway.Infrastructure.Auth;

public sealed class HttpContextCurrentUser(IHttpContextAccessor httpContextAccessor) : ICurrentUser
{
    public bool IsAuthenticated => !string.IsNullOrWhiteSpace(UserId);

    public string? UserId =>
        httpContextAccessor.HttpContext?.User.FindFirst("sub")?.Value
        ?? httpContextAccessor.HttpContext?.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
}
