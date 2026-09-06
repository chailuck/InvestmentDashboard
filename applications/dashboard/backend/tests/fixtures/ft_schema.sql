-- Financial-Tracker (ft_*) schema fixture for backup/restore tests.
--
-- Hand-authored to match applications/dashboard/tracking-backend/app/models/*.py
-- and applications/dashboard/tracking-backend/app/models/bond.py as of
-- 2026-09-01. Kept deliberately clean (one statement per ";", no inline
-- comments inside a statement) so the test conftest can split and execute it
-- through the asyncpg driver, which rejects multi-statement prepared queries.
--
-- Regenerate (read-only) with, against a fully-migrated investment_db:
--   pg_dump -U postgres -d investment_db --schema-only --no-owner \
--           --no-privileges -t 'public.ft_*'
-- then re-clean by hand. Requires the "uuid-ossp" extension (the conftest
-- creates it before loading this file).

CREATE TABLE ft_alembic_version (
    version_num varchar(32) NOT NULL,
    CONSTRAINT ft_alembic_version_pkc PRIMARY KEY (version_num)
);

CREATE TABLE ft_tracking_set (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name varchar(255) NOT NULL,
    description text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_tracking_set_pkey PRIMARY KEY (id),
    CONSTRAINT uq_ft_tracking_set_user_id_name UNIQUE (user_id, name)
);

CREATE INDEX ix_ft_tracking_set_user_id ON ft_tracking_set (user_id);

CREATE TABLE ft_category (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tracking_set_id uuid NOT NULL,
    name varchar(255) NOT NULL,
    description text,
    order_index integer DEFAULT 0 NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_category_pkey PRIMARY KEY (id),
    CONSTRAINT ft_category_tracking_set_id_fkey FOREIGN KEY (tracking_set_id)
        REFERENCES ft_tracking_set (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_category_set_order ON ft_category (tracking_set_id, order_index);
CREATE INDEX ix_ft_category_tracking_set_id ON ft_category (tracking_set_id);
CREATE INDEX ix_ft_category_user_id ON ft_category (user_id);

CREATE TABLE ft_sub_category (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name varchar(255) NOT NULL,
    description text,
    order_index integer DEFAULT 0 NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_sub_category_pkey PRIMARY KEY (id),
    CONSTRAINT ft_sub_category_category_id_fkey FOREIGN KEY (category_id)
        REFERENCES ft_category (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_sub_category_cat_order ON ft_sub_category (category_id, order_index);
CREATE INDEX ix_ft_sub_category_category_id ON ft_sub_category (category_id);
CREATE INDEX ix_ft_sub_category_user_id ON ft_sub_category (user_id);

CREATE TABLE ft_tracking_item (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    sub_category_id uuid NOT NULL,
    name varchar(255) NOT NULL,
    type varchar(30) NOT NULL,
    initial_investment_tracking boolean DEFAULT false NOT NULL,
    exclusive boolean DEFAULT false NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    description text,
    account_name varchar(255),
    remark text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_tracking_item_pkey PRIMARY KEY (id),
    CONSTRAINT ck_ft_tracking_item_type CHECK (type IN ('Bank account', 'Property', 'Investment Account', 'TaxSaving', 'Materials', 'Insurance', 'BOND')),
    CONSTRAINT ft_tracking_item_sub_category_id_fkey FOREIGN KEY (sub_category_id)
        REFERENCES ft_sub_category (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_tracking_item_subcat_order ON ft_tracking_item (sub_category_id, order_index);
CREATE INDEX ix_ft_tracking_item_sub_category_id ON ft_tracking_item (sub_category_id);
CREATE INDEX ix_ft_tracking_item_user_id ON ft_tracking_item (user_id);

CREATE TABLE ft_update_tracking_list (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tracking_set_id uuid NOT NULL,
    transaction_date date NOT NULL,
    quarter integer,
    year integer,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_update_tracking_list_pkey PRIMARY KEY (id),
    CONSTRAINT ft_update_tracking_list_tracking_set_id_fkey FOREIGN KEY (tracking_set_id)
        REFERENCES ft_tracking_set (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_update_tracking_list_set_date ON ft_update_tracking_list (tracking_set_id, transaction_date);
CREATE INDEX ix_ft_update_tracking_list_tracking_set_id ON ft_update_tracking_list (tracking_set_id);
CREATE INDEX ix_ft_update_tracking_list_user_id ON ft_update_tracking_list (user_id);

CREATE TABLE ft_update_tracking_list_balance (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    update_tracking_list_id uuid NOT NULL,
    tracking_item_id uuid NOT NULL,
    balance numeric(19, 4),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_update_tracking_list_balance_pkey PRIMARY KEY (id),
    CONSTRAINT uq_ft_update_tracking_list_balance_list_item UNIQUE (update_tracking_list_id, tracking_item_id),
    CONSTRAINT ft_update_tracking_list_balance_update_tracking_list_id_fkey FOREIGN KEY (update_tracking_list_id)
        REFERENCES ft_update_tracking_list (id) ON DELETE CASCADE,
    CONSTRAINT ft_update_tracking_list_balance_tracking_item_id_fkey FOREIGN KEY (tracking_item_id)
        REFERENCES ft_tracking_item (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_update_tracking_list_balance_list_id ON ft_update_tracking_list_balance (update_tracking_list_id);
CREATE INDEX ix_ft_update_tracking_list_balance_item_id ON ft_update_tracking_list_balance (tracking_item_id);
CREATE INDEX ix_ft_update_tracking_list_balance_user_id ON ft_update_tracking_list_balance (user_id);

CREATE TABLE ft_initial_investment_entry (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tracking_item_id uuid NOT NULL,
    amount numeric(19, 4) NOT NULL,
    entry_date date NOT NULL,
    note varchar(500),
    code varchar(100),
    name varchar(100),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_initial_investment_entry_pkey PRIMARY KEY (id),
    CONSTRAINT ck_ft_entry_amount_nonzero CHECK (amount <> 0),
    CONSTRAINT ft_initial_investment_entry_tracking_item_id_fkey FOREIGN KEY (tracking_item_id)
        REFERENCES ft_tracking_item (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_entry_tracking_item_id ON ft_initial_investment_entry (tracking_item_id);
CREATE INDEX ix_ft_entry_item_date ON ft_initial_investment_entry (tracking_item_id, entry_date);

CREATE TABLE ft_bond (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tracking_item_id uuid NOT NULL,
    code varchar(100) NOT NULL,
    issuer varchar(200),
    start_date date,
    expired_date date,
    amount numeric(19, 4) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT ft_bond_pkey PRIMARY KEY (id),
    CONSTRAINT ck_ft_bond_amount_nonneg CHECK (amount >= 0),
    CONSTRAINT ft_bond_tracking_item_id_fkey FOREIGN KEY (tracking_item_id)
        REFERENCES ft_tracking_item (id) ON DELETE CASCADE
);

CREATE INDEX ix_ft_bond_tracking_item_id ON ft_bond (tracking_item_id);
