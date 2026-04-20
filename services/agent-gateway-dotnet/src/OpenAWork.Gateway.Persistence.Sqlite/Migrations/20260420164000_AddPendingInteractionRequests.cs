using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenAWork.Gateway.Persistence.Sqlite.Migrations
{
    [DbContext(typeof(OpenAWork.Gateway.Persistence.EFCore.GatewayDbContext))]
    [Migration("20260420164000_AddPendingInteractionRequests")]
    public partial class AddPendingInteractionRequests : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "permission_requests",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    session_id = table.Column<string>(type: "TEXT", nullable: false),
                    tool_name = table.Column<string>(type: "TEXT", nullable: false),
                    scope = table.Column<string>(type: "TEXT", nullable: false),
                    reason = table.Column<string>(type: "TEXT", nullable: false),
                    risk_level = table.Column<string>(type: "TEXT", nullable: false),
                    preview_action = table.Column<string>(type: "TEXT", nullable: true),
                    status = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "pending"),
                    decision = table.Column<string>(type: "TEXT", nullable: true),
                    request_payload_json = table.Column<string>(type: "TEXT", nullable: true),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: true),
                    always_json = table.Column<string>(type: "TEXT", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_permission_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_permission_requests_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_requests",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    session_id = table.Column<string>(type: "TEXT", nullable: false),
                    user_id = table.Column<string>(type: "TEXT", nullable: false),
                    tool_name = table.Column<string>(type: "TEXT", nullable: false),
                    title = table.Column<string>(type: "TEXT", nullable: false),
                    questions_json = table.Column<string>(type: "TEXT", nullable: false),
                    answer_json = table.Column<string>(type: "TEXT", nullable: true),
                    request_payload_json = table.Column<string>(type: "TEXT", nullable: true),
                    expires_at = table.Column<long>(type: "INTEGER", nullable: true),
                    status = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "pending"),
                    created_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_question_requests_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_question_requests_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_permission_requests_session_id",
                table: "permission_requests",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_requests_session_id",
                table: "question_requests",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "IX_question_requests_user_id",
                table: "question_requests",
                column: "user_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "permission_requests");
            migrationBuilder.DropTable(name: "question_requests");
        }
    }
}
