use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

pub const DATA_VERSION: u8 = 1;
pub const SUBMITTED_STATUS: u8 = 1;

#[program]
pub mod proposal_submission {
    use super::*;

    pub fn submit_proposal(
        ctx: Context<SubmitProposalV1>,
        proposal_id_hash: [u8; 32],
        content_hash: [u8; 32],
        signature_hash: [u8; 32],
        author_pubkey: Pubkey,
        status: u8,
    ) -> Result<()> {
        require!(status == SUBMITTED_STATUS, Stage6Error::InvalidStatus);

        let clock = Clock::get()?;

        let submission = &mut ctx.accounts.submission;
        submission.data_version = DATA_VERSION;
        submission.proposal_id_hash = proposal_id_hash;
        submission.content_hash = content_hash;
        submission.author_pubkey = author_pubkey;
        submission.status = status;
        submission.submitted_at_unix = clock.unix_timestamp;
        submission.signature_hash = signature_hash;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(proposal_id_hash: [u8; 32], content_hash: [u8; 32], status: u8)]
pub struct SubmitProposalV1<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + ProposalSubmissionV1::LEN,
        seeds = [
            b"proposal_submission",
            &[DATA_VERSION],
            &proposal_id_hash,
            &content_hash
        ],
        bump
    )]
    pub submission: Account<'info, ProposalSubmissionV1>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct ProposalSubmissionV1 {
    pub data_version: u8,
    pub proposal_id_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub author_pubkey: Pubkey,
    pub status: u8,
    pub submitted_at_unix: i64,
    pub signature_hash: [u8; 32],
}

impl ProposalSubmissionV1 {
    // Excludes Anchor 8-byte account discriminator.
    pub const LEN: usize = 1 + 32 + 32 + 32 + 1 + 8 + 32;
}

#[error_code]
pub enum Stage6Error {
    #[msg("Invalid proposal status for submit_proposal")]
    InvalidStatus,
}

