using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class SessionRecordConfiguration : IEntityTypeConfiguration<SessionRecord>
{
    public void Configure(EntityTypeBuilder<SessionRecord> builder)
    {
        builder.ToTable("sessions");
        builder.HasKey((session) => session.Id);
        builder.Property((session) => session.Id).HasColumnName("id").IsRequired();
        builder.Property((session) => session.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((session) => session.MessagesJson)
            .HasColumnName("messages_json")
            .HasDefaultValue("[]")
            .IsRequired();
        builder.Property((session) => session.StateStatus)
            .HasColumnName("state_status")
            .HasDefaultValue("idle")
            .IsRequired();
        builder.Property((session) => session.MetadataJson)
            .HasColumnName("metadata_json")
            .HasDefaultValue("{}")
            .IsRequired();
        builder.Property((session) => session.Title).HasColumnName("title");
        builder.Property((session) => session.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((session) => session.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((session) => new { session.UserId, session.UpdatedAtUtc });
        builder.HasOne((session) => session.User)
            .WithMany()
            .HasForeignKey((session) => session.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
