using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenAWork.Gateway.Persistence.PostgreSql.Migrations
{
    [DbContext(typeof(OpenAWork.Gateway.Persistence.EFCore.GatewayDbContext))]
    [Migration("20260421093000_AddTaskParentAutoResumeContexts")]
    public partial class AddTaskParentAutoResumeContexts : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "task_parent_auto_resume_contexts",
                columns: table => new
                {
                    child_session_id = table.Column<string>(type: "text", nullable: false),
                    parent_session_id = table.Column<string>(type: "text", nullable: false),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    task_id = table.Column<string>(type: "text", nullable: false),
                    request_data_json = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_parent_auto_resume_contexts", x => x.child_session_id);
                    table.ForeignKey(
                        name: "FK_task_parent_auto_resume_contexts_sessions_child_session_id",
                        column: x => x.child_session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_task_parent_auto_resume_contexts_sessions_parent_session_id",
                        column: x => x.parent_session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_task_parent_auto_resume_contexts_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_task_parent_auto_resume_contexts_parent_session_id",
                table: "task_parent_auto_resume_contexts",
                column: "parent_session_id");

            migrationBuilder.CreateIndex(
                name: "IX_task_parent_auto_resume_contexts_user_id",
                table: "task_parent_auto_resume_contexts",
                column: "user_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "task_parent_auto_resume_contexts");
        }
    }
}
