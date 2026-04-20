using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace OpenAWork.Gateway.IntegrationTests;

internal static class AuthTestTokenFactory
{
    private const string DefaultJwtSecret = "change-me-in-production-min-32-chars";
    private const string DefaultJwtIssuer = "OpenAWork.Gateway.DotNet";
    private const string DefaultJwtAudience = "OpenAWork.Client";

    public static string Create(string userId, string email = "test@openawork.local")
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(DefaultJwtSecret)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: DefaultJwtIssuer,
            audience: DefaultJwtAudience,
            claims:
            [
                new Claim("sub", userId),
                new Claim("email", email),
            ],
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
