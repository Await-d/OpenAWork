using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class QuestionRequestRecordConfiguration : IEntityTypeConfiguration<QuestionRequestRecord>
{
    public void Configure(EntityTypeBuilder<QuestionRequestRecord> builder)
    {
        builder.ToTable("question_requests");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).HasColumnName("id").IsRequired();
        builder.Property((record) => record.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((record) => record.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((record) => record.ToolName).HasColumnName("tool_name").IsRequired();
        builder.Property((record) => record.Title).HasColumnName("title").IsRequired();
        builder.Property((record) => record.QuestionsJson).HasColumnName("questions_json").IsRequired();
        builder.Property((record) => record.AnswerJson).HasColumnName("answer_json");
        builder.Property((record) => record.RequestPayloadJson).HasColumnName("request_payload_json");
        builder.Property((record) => record.ExpiresAtMs).HasColumnName("expires_at");
        builder.Property((record) => record.Status)
            .HasColumnName("status")
            .HasDefaultValue("pending")
            .IsRequired();
        builder.Property((record) => record.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((record) => record.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasOne((record) => record.Session)
            .WithMany()
            .HasForeignKey((record) => record.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((record) => record.User)
            .WithMany()
            .HasForeignKey((record) => record.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
