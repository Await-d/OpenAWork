namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompanionChatResponse(
    string Text,
    string ProfileName,
    string ProfileSpecies,
    string Tone);
