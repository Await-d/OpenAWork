using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class TaskParentAutoResumeContextRecordConfiguration : IEntityTypeConfiguration<TaskParentAutoResumeContextRecord>
{
    public void Configure(EntityTypeBuilder<TaskParentAutoResumeContextRecord> builder)
    {
        builder.ToTable("task_parent_auto_resume_contexts");
        builder.HasKey((record) => record.ChildSessionId);
        builder.Property((record) => record.ChildSessionId).HasColumnName("child_session_id").IsRequired();
        builder.Property((record) => record.ParentSessionId).HasColumnName("parent_session_id").IsRequired();
        builder.Property((record) => record.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((record) => record.TaskId).HasColumnName("task_id").IsRequired();
        builder.Property((record) => record.RequestDataJson).HasColumnName("request_data_json").IsRequired();
        builder.Property((record) => record.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((record) => record.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((record) => record.ParentSessionId);
        builder.HasIndex((record) => record.UserId);
        builder.HasOne((record) => record.ChildSession)
            .WithMany()
            .HasForeignKey((record) => record.ChildSessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((record) => record.ParentSession)
            .WithMany()
            .HasForeignKey((record) => record.ParentSessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((record) => record.User)
            .WithMany()
            .HasForeignKey((record) => record.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
