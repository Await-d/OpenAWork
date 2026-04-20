using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class MessageV2RecordConfiguration : IEntityTypeConfiguration<MessageV2Record>
{
    public void Configure(EntityTypeBuilder<MessageV2Record> builder)
    {
        builder.ToTable("message_v2");
        builder.HasKey((message) => message.Id);
        builder.Property((message) => message.Id).HasColumnName("id").IsRequired();
        builder.Property((message) => message.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((message) => message.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((message) => message.TimeCreated).HasColumnName("time_created").IsRequired();
        builder.Property((message) => message.DataJson).HasColumnName("data").IsRequired();
        builder.Property((message) => message.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((message) => message.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((message) => new { message.SessionId, message.TimeCreated, message.Id })
            .HasDatabaseName("idx_message_v2_session_time");
        builder.HasOne((message) => message.Session)
            .WithMany()
            .HasForeignKey((message) => message.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((message) => message.User)
            .WithMany()
            .HasForeignKey((message) => message.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
