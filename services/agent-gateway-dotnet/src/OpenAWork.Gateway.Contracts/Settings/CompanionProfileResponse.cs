namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompanionProfileResponse(
    string AccentColor,
    string AccentTint,
    string Archetype,
    string Glyph,
    string Name,
    string Note,
    string RarityStars,
    string Species,
    CompanionSpriteResponse Sprite,
    IReadOnlyList<string> Traits);
