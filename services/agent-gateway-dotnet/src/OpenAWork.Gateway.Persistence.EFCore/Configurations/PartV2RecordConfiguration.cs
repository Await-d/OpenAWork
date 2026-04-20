using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class PartV2RecordConfiguration : IEntityTypeConfiguration<PartV2Record>
{
    public void Configure(EntityTypeBuilder<PartV2Record> builder)
    {
        builder.ToTable("part_v2");
        builder.HasKey((part) => part.Id);
        builder.Property((part) => part.Id).HasColumnName("id").IsRequired();
        builder.Property((part) => part.MessageId).HasColumnName("message_id").IsRequired();
        builder.Property((part) => part.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((part) => part.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((part) => part.TimeCreated).HasColumnName("time_created").IsRequired();
        builder.Property((part) => part.DataJson).HasColumnName("data").IsRequired();
        builder.Property((part) => part.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((part) => part.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((part) => new { part.MessageId, part.Id })
            .HasDatabaseName("idx_part_v2_message");
        builder.HasIndex((part) => part.SessionId)
            .HasDatabaseName("idx_part_v2_session");
        builder.HasOne((part) => part.Message)
            .WithMany()
            .HasForeignKey((part) => part.MessageId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((part) => part.Session)
            .WithMany()
            .HasForeignKey((part) => part.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((part) => part.User)
            .WithMany()
            .HasForeignKey((part) => part.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
