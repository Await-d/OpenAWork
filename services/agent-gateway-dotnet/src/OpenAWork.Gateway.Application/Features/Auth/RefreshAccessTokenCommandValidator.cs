using FluentValidation;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class RefreshAccessTokenCommandValidator : AbstractValidator<RefreshAccessTokenCommand>
{
    public RefreshAccessTokenCommandValidator()
    {
    }
}
